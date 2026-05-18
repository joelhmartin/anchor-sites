import { Button } from "../ui/Button.jsx";

export function OAuthButtons() {
  const handleGoogle = () => {
    window.location.href = "/api/v1/auth/oauth/google";
  };

  return (
    <div className="space-y-2">
      <Button variant="secondary" className="w-full" onClick={handleGoogle}>
        Continue with Google
      </Button>
    </div>
  );
}
