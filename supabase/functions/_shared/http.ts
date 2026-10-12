// _shared/http
//
// The CORS headers and JSON responder the office-management functions answer
// with. The browser invokes these functions directly on the anon key, so every
// response — including the refusals — has to carry the CORS headers.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

export function respond(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}
