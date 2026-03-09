/**
 * API Configuration for FastAPI backend.
 * 
 * This file provides a centralized way to configure the API base URL.
 * Set NEXT_PUBLIC_API_URL in your .env.local file (or .env) to point to your FastAPI server.
 * Defaults to http://localhost:8020 for local development.
 * 
 * IMPORTANT: Use localhost (not 0.0.0.0) as browsers cannot access 0.0.0.0
 * The server binds to 0.0.0.0:8020 to accept connections from any interface,
 * but the frontend must use localhost:8020 to connect from the browser.
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8020'

/**
 * Get the full API URL for an endpoint.
 */
export function getApiUrl(endpoint: string): string {
  // Remove leading slash if present to avoid double slashes
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint
  return `${API_BASE_URL}/${cleanEndpoint}`
}
