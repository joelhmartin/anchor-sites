import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { ROUTES } from "../../config/routes.js";
import api from "../../config/api.js";

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }

    api
      .post("/auth/verify-email", { token })
      .then(() => setStatus("success"))
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <AuthLayout>
      <Card className="text-center">
        {status === "loading" && <Spinner />}
        {status === "success" && (
          <>
            <h2 className="text-xl font-semibold">Email verified!</h2>
            <p className="mt-2 text-sm text-gray-500">You can now use all features.</p>
            <Link to={ROUTES.DASHBOARD} className="mt-4 inline-block text-brand-600 hover:underline">
              Go to dashboard
            </Link>
          </>
        )}
        {status === "error" && (
          <>
            <h2 className="text-xl font-semibold">Verification failed</h2>
            <p className="mt-2 text-sm text-gray-500">The link may be expired or invalid.</p>
            <Link to={ROUTES.LOGIN} className="mt-4 inline-block text-brand-600 hover:underline">
              Back to sign in
            </Link>
          </>
        )}
      </Card>
    </AuthLayout>
  );
}
