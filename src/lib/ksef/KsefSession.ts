import axios from 'axios';
import { Builder } from 'xml2js';
import { KsefEncryption } from './KsefEncryption';

// Environments
export const KSEF_ENV = {
    TEST: 'https://ksef-test.mf.gov.pl/api',
    PROD: 'https://ksef.mf.gov.pl/api',
};

// Keys (We will need to load these dynamically or from env vars, but hardcoding the paths/fetching them is needed)
// For now, I'll allow passing the public key or fetching it.

interface AuthChallengeResponse {
    timestamp: string;
    challenge: string;
}

interface SessionStatusResponse {
    referenceNumber: string;
    processingCode: number;
    processingDescription: string;
    timestamp: string;
    sessionToken: SessionToken;
}

interface SessionToken {
    token: string;
    context: any;
}

export class KsefSession {
    private baseUrl: string;
    private builder: Builder;

    constructor(isProd: boolean = false) {
        this.baseUrl = isProd ? KSEF_ENV.PROD : KSEF_ENV.TEST;
        this.builder = new Builder({ headless: true, renderOpts: { pretty: false } });
    }

    /**
     * Diagnostic: Check connectivity
     */
    async checkConnectivity(): Promise<boolean> {
        try {
            // Public endpoint check - KSeF also exposes /online/Definition/PublicCredentials
            const url = `${this.baseUrl}/online/Definition/PublicCredentials`;
            console.log("Checking connectivity to:", url);
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ksef-monitor-web/1.0',
                    'Accept': 'application/json'
                }
            });
            console.log("Connectivity OK. Status:", response.status);
            return true;
        } catch (e: any) {
            console.error("Connectivity Check Failed:", e.message);
            if (e.response) {
                console.error("Status:", e.response.status);
                // console.error("Data:", JSON.stringify(e.response.data));
            }
            return false;
        }
    }

    /**
     * 1. Get Authorisation Challenge
     */
    async getChallenge(nip: string): Promise<AuthChallengeResponse> {
        const url = `${this.baseUrl}/online/Session/AuthorisationChallenge?type=serial&identifier=${nip}`;

        try {
            const response = await axios.post(url, {}, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ksef-monitor-web/1.0',
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            // API returns: { timestamp: "...", challenge: "..." } wrapped in standard KSeF structure
            // Example: { exception: { ... }, referenceNumber: "...", timestamp: "..." } 
            // Actually standard success is: { timestamp: ISO, challenge: "..." } inside the root wrapper?
            // KSeF JSONs are usually wrapped. Let's assume standard parsing.

            const data = response.data;
            if (!data.timestamp || !data.challenge) {
                throw new Error('Invalid challenge response: ' + JSON.stringify(data));
            }

            return {
                timestamp: data.timestamp,
                challenge: data.challenge
            };
        } catch (error: any) {
            console.error("KSeF Challenge Error:", error?.response?.data || error.message);
            throw error;
        }
    }

    /**
     * 2. Initialize Session (Login)
     */
    async initSession(nip: string, token: string, publicKey: string): Promise<string> {
        // A. Get Challenge
        const { timestamp, challenge } = await this.getChallenge(nip);

        // B. Encrypt Token
        const encryptedToken = KsefEncryption.encryptToken(token, timestamp, publicKey);

        // C. Build XML
        const xml = this.buildInitSessionXML(nip, challenge, encryptedToken);

        // D. Call API
        const url = `${this.baseUrl}/online/Session/InitToken`;

        // We must send the XML as bytes (octet-stream) or simple body
        try {
            const response = await axios.post(url, xml, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Accept': 'application/json'
                },
                transformRequest: [(data) => data] // Prevent axios from stringifying if it tries
            });

            const sessionToken = response.data.sessionToken.token;
            return sessionToken;
        } catch (error: any) {
            console.error("KSeF InitSession Error:", error?.response?.data || error.message);
            throw new Error("Failed to initialize session: " + (error?.response?.data?.exception?.message || error.message));
        }
    }

    private buildInitSessionXML(nip: string, challenge: string, encryptedToken: string): string {
        const obj = {
            'ns3:InitSessionTokenRequest': {
                $: {
                    'xmlns:ns3': 'http://ksef.mf.gov.pl/schema/gtw/svc/online/auth/request/2021/10/01/0001',
                    'xmlns:ns2': 'http://ksef.mf.gov.pl/schema/gtw/svc/types/2021/10/01/0001',
                    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance'
                },
                'ns3:Context': {
                    'ns2:Challenge': challenge,
                    'ns2:Identifier': {
                        $: { 'xsi:type': 'ns2:SubjectIdentifierByCompanyType' },
                        'ns2:Identifier': nip
                    },
                    'ns2:DocumentType': {
                        'ns2:Service': 'KSeF',
                        'ns2:FormCode': {
                            $: {
                                'systemCode': 'FA (2)',
                                'schemaVersion': '1-0E'
                            },
                            '_': 'FA'
                        }
                    },
                    'ns2:Token': encryptedToken
                }
            }
        };

        return this.builder.buildObject(obj);
    }

    /**
     * 3. Fetch Invoices (Sync Query)
     */
    async fetchInvoices(sessionToken: string, fromDate: Date, toDate: Date = new Date()): Promise<any[]> {
        const url = `${this.baseUrl}/online/Query/Invoice/Sync?PageSize=100&PageOffset=0`;

        const payload = {
            queryCriteria: {
                subjectType: "subject1",
                type: "detail", // 'detail' gives more info, 'invoice' is basic
                acquisitionTimestampThresholdFrom: fromDate.toISOString(),
                acquisitionTimestampThresholdTo: toDate.toISOString()
            }
        };

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    'SessionToken': sessionToken,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            // Structure: { timestamp: "...", referenceNumber: "...", invoiceHeaderList: [ ... ] }
            return response.data.invoiceHeaderList || [];
        } catch (error: any) {
            console.error("KSeF FetchInvoices Error:", error?.response?.data || error.message);
            // If error is 21104 (No results), return empty
            if (error?.response?.data?.exception?.serviceCode === '21104' ||
                error?.response?.data?.exception?.exceptionDetailList?.[0]?.exceptionCode === 21104) {
                return [];
            }
            throw error;
        }
    }
}
