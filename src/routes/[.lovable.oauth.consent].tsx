import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/[.lovable/oauth/consent]")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
  component: () => null,
});
