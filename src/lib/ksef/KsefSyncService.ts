import { supabase } from '@/lib/supabase';
import { KsefSession } from './KsefSession';
import { KSEF_KEYS } from './KsefKeys';

export class KsefSyncService {

    /**
     * Main sync function.
     * 1. Get last sync time from DB.
     * 2. Login to KSeF.
     * 3. Fetch invoices > last sync time.
     * 4. Save to DB.
     * 5. Update last sync time.
     */
    static async runSync() {
        // 1. Get Last Sync
        let lastSyncDate = await this.getLastSyncDate();
        const now = new Date();

        console.log(`Last sync: ${lastSyncDate.toISOString()}, Now: ${now.toISOString()}`);

        // 2. Credentials
        const nip = process.env.KSEF_NIP;
        const token = process.env.KSEF_TOKEN;
        const isProd = process.env.KSEF_ENV === 'PROD';
        let publicKey = process.env.KSEF_PUBLIC_KEY;
        if (!publicKey) {
            publicKey = isProd ? KSEF_KEYS.PROD : KSEF_KEYS.TEST;
        }

        if (!nip || !token) throw new Error("Missing Credentials");

        // 3. Login
        const session = new KsefSession(isProd);
        // Check connectivity first? Optional optimization.

        const sessionToken = await session.initSession(nip, token, publicKey);

        // 4. Fetch
        const invoices = await session.fetchInvoices(sessionToken, lastSyncDate, now);
        console.log(`Found ${invoices.length} new invoices.`);

        // 5. Save & Notify
        if (invoices.length > 0) {
            await this.saveInvoices(invoices);
            // TODO: Trigger Notifications Here
        }

        // 6. Update Sync State
        await this.updateLastSyncDate(now);

        return {
            synced_at: now,
            new_invoices_count: invoices.length,
            invoices: invoices
        };
    }

    private static async getLastSyncDate(): Promise<Date> {
        const { data, error } = await supabase
            .from('ksef_state')
            .select('value')
            .eq('key', 'last_sync')
            .single();

        if (error || !data) {
            // Default: 24h ago
            const d = new Date();
            d.setDate(d.getDate() - 1);
            return d;
        }

        return new Date(data.value.timestamp);
    }

    private static async updateLastSyncDate(date: Date) {
        await supabase
            .from('ksef_state')
            .upsert({
                key: 'last_sync',
                value: { timestamp: date.toISOString() }
            });
    }

    private static async saveInvoices(invoices: any[]) {
        const rows = invoices.map(inv => ({
            reference_number: inv.ksefReferenceNumber,
            invoice_number: inv.invoiceReferenceNumber,
            seller_nip: inv.subjectBy?.issuer?.identifier,
            buyer_nip: "MY_COMPANY", // Usually we are the buyer if query was for acquisitions
            amount_gross: inv.grossDiff || inv.gross, // Simplification, need to check KSeF field names carefully
            invoice_date: inv.invoicingDate,
            acquisition_timestamp: inv.acquisitionTimestamp
        }));

        const { error } = await supabase
            .from('ksef_invoices')
            .upsert(rows, { onConflict: 'reference_number' });

        if (error) console.error("Error saving invoices:", error);
    }
}
