export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const apiKey = localStorage.getItem('CLAUDE_MEM_SERVER_BETA_API_KEY');
  
  if (apiKey) {
    const newInit = { ...init };
    const headers = new Headers(newInit.headers || {});
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${apiKey}`);
    }
    newInit.headers = headers;
    return fetch(input, newInit);
  }
  
  return fetch(input, init);
}
