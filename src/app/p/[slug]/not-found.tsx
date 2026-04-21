export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      textAlign: 'center',
    }}>
      <h1 style={{ fontSize: 24, margin: '0 0 12px', fontWeight: 700 }}>
        Link not found
      </h1>
      <p style={{ color: '#666', margin: 0, maxWidth: 400 }}>
        This assignment page isn&apos;t available. Please contact your recruiter
        for an updated link.
      </p>
    </div>
  );
}
