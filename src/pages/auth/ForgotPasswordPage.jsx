import { Link } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout.jsx";
import { ForgotPasswordForm } from "../../components/auth/ForgotPasswordForm.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { ROUTES } from "../../config/routes.js";

export function ForgotPasswordPage() {
  return (
    <AuthLayout>
      <Card>
        <h2 className="mb-6 text-center text-xl font-semibold">Reset your password</h2>
        <ForgotPasswordForm />
        <p className="mt-4 text-center text-sm text-gray-500">
          <Link to={ROUTES.LOGIN} className="text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
