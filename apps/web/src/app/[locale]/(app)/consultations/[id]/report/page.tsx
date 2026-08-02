import { redirect } from "next/navigation";

/** The report merged into the consultation overview. */
export default async function ReportRedirect({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  redirect(`/${locale}/consultations/${id}`);
}
