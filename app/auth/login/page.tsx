import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        {/*
          The form reads `next` from the query string to send the viewer back where they
          were, and a component that reads search parameters cannot be part of a
          statically rendered shell. The boundary is what keeps the rest of the page
          static rather than making the whole route dynamic.
        */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
