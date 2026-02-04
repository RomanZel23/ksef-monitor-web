import { Builder } from 'xml2js';
import { KsefEncryption } from './KsefEncryption';
import https from 'https';

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


export class KsefSession {
    private baseUrl: string;
    private builder: Builder;

    constructor(isProd: boolean = false) {
        this.baseUrl = isProd ? KSEF_ENV.PROD : KSEF_ENV.TEST;
        this.builder = new Builder({ headless: true, renderOpts: { pretty: false } });
    }

    /**
     * Helper for Fetch calls
     */
    private async call(endpoint: string, method: string, body?: any, headers: any = {}): Promise<any> {
        const url = `${this.baseUrl}${endpoint}`;

        console.log(`[${method}] ${url}`);

        const defaultHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };

        const config: RequestInit = {
            method,
            headers: { ...defaultHeaders, ...headers },
            body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
            // Force node-fetch to respect connection rules?
            // @ts-ignore
            duplex: body ? 'half' : undefined
        };

        try {
            const response = await fetch(url, config);

            if (!response.ok) {
                const text = await response.text();
                // console.error(`Status ${response.status}: ${text}`); // Optional log
                throw new Error(`KSeF Error ${response.status}: ${text.substring(0, 200)}`);
            }

            return await response.json();
        } catch (error: any) {
            console.error("Fetch Error:", error.message);
            // Enhance error message with cause if available
            const cause = error.cause ? JSON.stringify(error.cause) : (error.code || 'Unknown');
            throw new Error(`Fetch failed: ${error.message} (Cause: ${cause})`);
        }
    }

    /**
     * Diagnostic: Check connectivity
     */
    async checkConnectivity(): Promise<boolean> {
        try {
            const url = `/online/Definition/PublicCredentials`;
            await this.call(url, 'GET');
            return true;
        } catch (e: any) {
            console.error("Connectivity Check Failed:", e.message);
            return false;
        }
    }

    /**
     * 1. Get Authorisation Challenge
     */
    async getChallenge(nip: string): Promise<AuthChallengeResponse> {
        const url = `/online/Session/AuthorisationChallenge?type=serial&identifier=${nip}`;
        const data = await this.call(url, 'POST', {});

        if (!data.timestamp || !data.challenge) {
            throw new Error('Invalid challenge response');
        }
        return { timestamp: data.timestamp, challenge: data.challenge };
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
        // Send as octet-stream
        const responseData = await this.call('/online/Session/InitToken', 'POST', xml, {
            'Content-Type': 'application/octet-stream'
        });

        return responseData.sessionToken.token;
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
        const payload = {
            queryCriteria: {
                subjectType: "subject1",
                type: "detail", // 'detail' gives more info, 'invoice' is basic
                acquisitionTimestampThresholdFrom: fromDate.toISOString(),
                acquisitionTimestampThresholdTo: toDate.toISOString()
            }
        };

        try {
            const data = await this.call('/online/Query/Invoice/Sync?PageSize=100&PageOffset=0', 'POST', payload, {
                'SessionToken': sessionToken
            });
            return data.invoiceHeaderList || [];
        } catch (error: any) {
            console.error("Fetch FetchInvoices Error:", error.message);
            // Return empty on specific errors if needed
            // checking message string logic here would be brittle but OK for now
            if (error.message.includes("21104")) return [];
            throw error;
        }
    }
}
