import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { useAuth } from "../../hooks/useAuth.js";
import { ROUTES } from "../../config/routes.js";
import api from "../../config/api.js";

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState("idle");

  const handleAccept = async () => {
    setStatus("loading");
    try {
      await api.post(`/invitations/${token}/accept`);
      setStatus("success");
      setTimeout(() => navigate(ROUTES.DASHBOARD), 1500);
    } catch {
      setStatus("error");
    }
  };

  if (!isAuthenticated) {
    return (
      <AuthLayout>
        <Card className="text-center">
          <h2 className="text-xl font-semibold">You've been invited!</h2>
          <p className="mt-2 text-sm text-gray-500">Please sign in or create an account to accept.</p>
          <Button className="mt-4" onClick={() => navigate(`${ROUTES.LOGIN}?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}>
            Sign in
          </Button>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card className="text-center">
        {status === "idle" && (
          <>
            <h2 className="text-xl font-semibold">Accept invitation?</h2>
            <Button className="mt-4" onClick={handleAccept}>Accept & Join</Button>
          </>
        )}
        {status === "loading" && <Spinner />}
        {status === "success" && <p className="text-green-600 font-medium">Joined! Redirecting...</p>}
        {status === "error" && <p className="text-red-600">Failed to accept invitation. It may be expired.</p>}
      </Card>
    </AuthLayout>
  );
}
