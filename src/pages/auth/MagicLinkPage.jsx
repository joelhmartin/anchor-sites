import { Link } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout.jsx";
import { MagicLinkForm } from "../../components/auth/MagicLinkForm.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { ROUTES } from "../../config/routes.js";

export function MagicLinkPage() {
  return (
    <AuthLayout>
      <Card>
        <h2 className="mb-6 text-center text-xl font-semibold">Sign in with email</h2>
        <MagicLinkForm />
        <p className="mt-4 text-center text-sm text-gray-500">
          <Link to={ROUTES.LOGIN} className="text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
