import { useParams } from "react-router-dom";

/** Real implementation (tabs) lands in P4-T4.12. */
export function SiteDetailPage() {
  const { slug } = useParams();
  return <h1 className="text-2xl font-semibold">{slug}</h1>;
}
