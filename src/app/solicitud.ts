'use client';

export async function fetchAutenticado(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401 && window.location.pathname !== '/login') {
    window.location.replace('/login');
  }
  return response;
}
