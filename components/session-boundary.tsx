'use client';

import { Component, type ReactNode } from 'react';

/**
 * Sends the viewer to sign in when a query reports there is no session, instead of
 * showing them an error.
 *
 * The proxy redirects unauthenticated *page* requests, so this covers what it cannot: a
 * session that expires while a tab is open, a sign-out in another tab, and any
 * client-side navigation, none of which go through the proxy. Before this, the shell's
 * `me` query would throw "You must be signed in to do that" and — being a suspense
 * query with no boundary above it — take the whole page down with it.
 *
 * A full page load rather than a router push, because the point is to go through the
 * proxy again and let it decide where the viewer belongs.
 */

function isUnauthorized(error: unknown): boolean {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  return code === 'UNAUTHORIZED';
}

export class SessionBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (isUnauthorized(error) && typeof window !== 'undefined') {
      const next = window.location.pathname + window.location.search;
      window.location.replace(`/auth/login?next=${encodeURIComponent(next)}`);
    }
  }

  render() {
    if (this.state.error) {
      // Anything that is not an expired session is a real fault and belongs to
      // whatever error boundary sits above this one. Swallowing it here would turn
      // every bug in a page into a silent redirect to the login screen.
      if (!isUnauthorized(this.state.error)) throw this.state.error;

      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">Taking you to sign in…</p>
        </div>
      );
    }

    return this.props.children;
  }
}
