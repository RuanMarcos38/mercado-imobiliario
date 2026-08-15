import { test, expect } from "@playwright/test";

test("Critical Flow: Login and Dashboard Access", async ({ page }) => {
  await page.goto("http://localhost:8080/auth");

  // O teste assume que o usuário está logado ou o ambiente injetou o token
  await page.goto("http://localhost:8080/dashboard");

  await expect(page.getByText(/Dashboard Geral/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Exportar Leads/i })).toBeVisible();
});

test("IA Agent: Property Search Index Visibility", async ({ page }) => {
  await page.goto("http://localhost:8080/dashboard");
  // Verifica se os cards de estatísticas (que dependem do backend) estão renderizando
  await expect(page.getByText(/Leads Totais/i)).toBeVisible();
  await expect(page.getByText(/Buscas Realizadas/i)).toBeVisible();
});
