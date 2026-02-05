import { NextResponse } from 'next/server';
import { KsefSyncService } from '@/lib/ksef/KsefSyncService';

export const maxDuration = 60; // Allow 60s for Vercel Functions (Pro plan allows more)
export const dynamic = 'force-dynamic'; // No caching

export async function GET() {
    try {
        const result = await KsefSyncService.runSync();
        return NextResponse.json({ status: 'ok', version: '2.0.0-demo-fix', data: result });
    } catch (error: any) {
        console.error("Sync Error:", error.message);
        return NextResponse.json({ status: 'error', version: '2.0.0-demo-fix', message: error.message }, { status: 500 });
    }
}
