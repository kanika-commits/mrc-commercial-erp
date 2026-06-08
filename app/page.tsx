import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const modules = [
  {
    title: "Admin & Setup",
    items: ["Companies", "Sites / Projects", "Users & Access", "Roles & Permissions", "Document Rules"],
  },
  {
    title: "Contract Management",
    items: ["Work Orders", "RA Bills", "Invoices & ITC", "Payments", "Debit Notes", "Commercial Ledger"],
  },
  {
    title: "Vendor Management",
    items: ["Vendor Master", "Vendor KYC", "Vendor Documents", "Vendor Ledger"],
  },
  {
    title: "Reports",
    items: ["WO Summary", "RA Bill Register", "Invoice & ITC Report", "Payment Register", "Debit Note Register"],
  },
];

const kpis = [
  ["Active Work Orders", "76"],
  ["Pending RA Bills", "12"],
  ["Pending ITC Review", "8"],
  ["Pending Payments", "5"],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="flex">
        <aside className="min-h-screen w-72 border-r bg-slate-950 px-5 py-6 text-white">
          <div className="mb-8">
            <h1 className="text-2xl font-bold">MRC Commercial</h1>
            <p className="text-sm text-slate-400">Contract Management ERP</p>
          </div>

          <nav className="space-y-6">
            {modules.map((module) => (
              <div key={module.title}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {module.title}
                </p>
                <div className="space-y-1">
                  {module.items.map((item) => (
                    <div
                      key={item}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <section className="flex-1">
          <header className="flex items-center justify-between border-b bg-white px-8 py-5">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
              <p className="text-sm text-slate-500">MRC Group · SaaS-ready organization foundation</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="secondary">Platform Owner</Badge>
              <Button>Create Work Order</Button>
            </div>
          </header>

          <div className="space-y-6 p-8">
            <div className="grid gap-4 md:grid-cols-4">
              {kpis.map(([label, value]) => (
                <Card key={label}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-500">{label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Contract Management Flow</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-6">
                  {["Work Order", "RA Bill", "Invoice / ITC", "Payment", "Debit Note", "Ledger"].map((step) => (
                    <div key={step} className="rounded-xl border bg-white p-4 text-center font-semibold">
                      {step}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              {modules.map((module) => (
                <Card key={module.title}>
                  <CardHeader>
                    <CardTitle>{module.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {module.items.map((item) => (
                      <Badge key={item} variant="outline">
                        {item}
                      </Badge>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}