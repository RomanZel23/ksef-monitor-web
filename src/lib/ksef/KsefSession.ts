import axios from 'axios';
import { Builder } from 'xml2js';
import { KsefEncryption } from './KsefEncryption';
import https from 'https';
import crypto from 'crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Environments
// Environments
export const KSEF_ENV = {
    TEST: 'https://api-test.ksef.mf.gov.pl',
    DEMO: 'https://api-demo.ksef.mf.gov.pl',
    PROD: 'https://api.ksef.mf.gov.pl',
};

type KsefEnvName = keyof typeof KSEF_ENV;

interface AuthChallengeResponse {
    timestamp: string;
    challenge: string;
}

export class KsefSession {
    private baseUrl: string;
    private builder: Builder;
    private axiosInstance: any;

    constructor(env: KsefEnvName = 'DEMO') {
        this.baseUrl = KSEF_ENV[env];
        this.builder = new Builder({ headless: true, renderOpts: { pretty: false } });

        const requestTimeout = 30000;
        const proxyUrl = process.env.KSEF_PROXY_URL;

        // Define base headers
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };

        if (proxyUrl) {
            console.log(`Using Proxy: ${proxyUrl.replace(/:[^:]*@/, ':***@')}`); // Log masked proxy

            // When using Proxy, the Proxy Agent handles TLS
            const httpsAgent = new HttpsProxyAgent(proxyUrl);

            this.axiosInstance = axios.create({
                baseURL: this.baseUrl,
                httpsAgent: httpsAgent,
                timeout: requestTimeout,
                headers: headers
            });
            this.axiosInstance = axios.create({
                baseURL: this.baseUrl,
                httpsAgent: httpsAgent,
                timeout: requestTimeout,
                headers: headers
            });
        } else {
            // Direct Connection: Use standard agent (Verified to work locally?)
            // We revert the complex "TLS Spoofing" because it might be causing ECONNRESET itself
            const httpsAgent = new https.Agent({
                keepAlive: true,
                // minVersion: 'TLSv1.2' // Optional
            });

            this.axiosInstance = axios.create({
                baseURL: this.baseUrl,
                httpsAgent: httpsAgent,
                timeout: requestTimeout,
                headers: headers
            });
        }
    }

    private async call(endpoint: string, method: string, body?: any, headers: any = {}): Promise<any> {
        console.log(`[${method}] ${this.baseUrl}${endpoint}`);

        try {
            const response = await this.axiosInstance.request({
                url: endpoint,
                method: method,
                data: body,
                headers: headers,
                // Ensure octet-stream is not stringified
                transformRequest: [(data: any, headers: any) => {
                    if (headers['Content-Type'] === 'application/octet-stream') {
                        return data;
                    }
                    if (typeof data === 'object') {
                        return JSON.stringify(data);
                    }
                    return data;
                }]
            });
            return response.data;
        } catch (error: any) {
            const status = error.response?.status;
            const data = error.response?.data;
            const msg = data ? JSON.stringify(data) : error.message;

            console.error(`KSeF Error ${status}: ${msg}`);

            // Include low-level cause if available
            const cause = error.cause ? JSON.stringify(error.cause) : error.code;
            throw new Error(`KSeF Call Failed: ${status} - ${msg} (Cause: ${cause})`);
        }
    }

    /**
     * Diagnostic: Check connectivity
     */
    /**
     * Diagnostic: Check connectivity
     */
    async checkConnectivity(): Promise<boolean> {
        try {
            // KSeF 2.0 endpoint (Verified)
            await this.call('/v2/security/public-key-certificates', 'GET');
            return true;
        } catch (e: any) {
            console.error("Connectivity Check Failed:", e.message);
            return false;
        }
    }

    /**
     * 1. Get Authorisation Challenge (KSeF 2.0)
     */
    async getChallenge(nip: string): Promise<AuthChallengeResponse> {
        // KSeF 2.0: POST /auth/challenge
        const body = {
            contextIdentifier: {
                type: 'Nip',
                value: nip
            }
        };

        const data = await this.call('/auth/challenge', 'POST', body, {
            'Content-Type': 'application/json'
        });

        if (!data.timestamp || !data.challenge) {
            throw new Error('Invalid challenge response');
        }
        return { timestamp: data.timestamp, challenge: data.challenge };
    }

    /**
     * 2. Initialize Session (Login) for KSeF 2.0
     */
    async initSession(nip: string, token: string, publicKey: string): Promise<string> {
        // A. Get Challenge
        const { timestamp, challenge } = await this.getChallenge(nip);

        // B. Encrypt Token
        const encryptedToken = KsefEncryption.encryptToken(token, timestamp, publicKey);

        // C. Build Request Body (JSON for KSeF 2.0)
        const body = {
            challenge: challenge,
            contextIdentifier: {
                type: 'Nip',
                value: nip
            },
            encryptedToken: encryptedToken
        };

        // D. Call API
        const responseData = await this.call('/auth/ksef-token', 'POST', body, {
            'Content-Type': 'application/json'
        });

        return responseData.accessToken.token;
    }

    // Deprecated: buildInitSessionXML is not used in KSeF 2.0 JSON flow

    /**
     * 3. Fetch Invoices (KSeF 2.0 Query Metadata)
     */
    async fetchInvoices(sessionToken: string, fromDate: Date, toDate: Date = new Date()): Promise<any[]> {
        const payload = {
            subjectType: "Subject1", // Case sensitive: Subject1 (Seller)
            dateRange: {
                dateType: "AcquisitionTimestamp",
                from: fromDate.toISOString(),
                to: toDate.toISOString()
            },
            // pageSize: 100, // Optional
            // pageOffset: 0
        };

        try {
            // KSeF 2.0 Endpoint
            const data = await this.call('/invoices/query/metadata?pageSize=100&pageOffset=0', 'POST', payload, {
                'Content-Type': 'application/json',
                'SessionToken': sessionToken // Header name might be same? Usually 'SessionToken' or 'Authorization: Bearer'?
                // Docs check: often KSeF 2.0 uses "SessionToken" or "Authorization"
            });

            // KSeF 2.0 response usually has "invoiceHeaderList" inside
            return data.invoiceHeaderList || [];
        } catch (error: any) {
            // Handle specific no-results code if applicable
            if (error.message.includes("21104")) return []; // Keep legacy check just in case code is same
            throw error;
        }
    }
}
