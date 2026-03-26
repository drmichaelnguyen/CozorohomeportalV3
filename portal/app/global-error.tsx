"use client";

// Last-resort fallback — catches errors that escape all route error.tsx boundaries,
// including crashes in the root layout itself. Must render its own <html> and <body>.
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="vi">
      <head>
        <meta charSet="utf-8" />
        <title>CozoroHome Portal</title>
      </head>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem"
          }}
        >
          <div
            style={{
              maxWidth: 420,
              width: "100%",
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              padding: "2rem",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)"
            }}
          >
            <p style={{ fontSize: 13, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
              CozoroHome Portal
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: "#0f172a", margin: "0.75rem 0 0.5rem" }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: 0, wordBreak: "break-word" }}>
              {error.message || "An unexpected error occurred. Please reload the page."}
            </p>
            <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
              <button
                type="button"
                onClick={reset}
                style={{
                  padding: "0.5rem 1.25rem",
                  fontSize: 13,
                  fontWeight: 500,
                  background: "#0f172a",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer"
                }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.assign("/")}
                style={{
                  padding: "0.5rem 1.25rem",
                  fontSize: 13,
                  fontWeight: 500,
                  background: "#fff",
                  color: "#374151",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  cursor: "pointer"
                }}
              >
                Go home
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
