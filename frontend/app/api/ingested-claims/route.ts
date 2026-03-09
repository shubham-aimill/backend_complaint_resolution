/**
 * GET /api/ingested-claims
 * Proxies to FastAPI backend server.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getApiUrl } from '@/lib/api-config';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const full = searchParams.get('full') === 'true';

    const url = getApiUrl(`api/ingested-complaints${full ? '?full=true' : ''}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: error.detail || 'Failed to fetch ingested claims' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const err = error as { name?: string; code?: string; message?: string };
    const isAbort = err.name === 'AbortError';
    const isRefused =
      err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED');
    const backendUnreachable = isAbort || isRefused;
    const message = backendUnreachable
      ? 'Backend not reachable. Start FastAPI: cd backend_modified && python -m backend.fastapi_server'
      : 'Failed to fetch ingested claims';
    console.error('Error fetching ingested claims:', error);
    return NextResponse.json(
      { error: message },
      { status: backendUnreachable ? 503 : 500 }
    );
  }
}
