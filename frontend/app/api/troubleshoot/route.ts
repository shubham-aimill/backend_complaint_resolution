import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    // 1. Extract the payload sent from DecisionPage.tsx
    const body = await request.json();
    const { product_name, complaint_description, complaint_type } = body;

    // 2. Point to your FastAPI backend (defaults to port 8020 based on your fastapi_server.py)
    const backendUrl = process.env.BACKEND_API_URL || 'http://127.0.0.1:8020';

    // 3. Forward the request to the Python backend
    const response = await fetch(`${backendUrl}/api/troubleshoot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_name,
        complaint_description,
        complaint_type,
      }),
    });

    // 4. Handle backend HTTP errors
    if (!response.ok) {
      console.error(`Backend returned ${response.status}: ${response.statusText}`);
      return NextResponse.json(
        { success: false, error: 'Backend failed to generate RAG troubleshooting steps' },
        { status: response.status }
      );
    }

    // 5. Pipe the grounded steps and citations back to the frontend
    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Error proxying to troubleshoot API:', error);
    
    // Return a structured error so DecisionPage.tsx gracefully falls back to generic steps
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal Server Error' 
      },
      { status: 500 }
    );
  }
}