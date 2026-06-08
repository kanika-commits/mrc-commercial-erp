import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const sidebarSections = [
  {
    title: "Dashboard",
    items: ["Command Center"],
  },
  {
    title: "Contract Management",
    items: [
      "Work Order Register",
      "RA Bills",
      "Invoices & ITC",
      "Payments",
      "Debit Notes",
      "Commercial Ledger",
    ],
  },
  {
    title: "Vendor Management",
    items: ["Vendor Master", "Vendor KYC", "Vendor Documents", "Vendor Performance"],
  },
  {
    title: "Reports",
    items: [
      "Commercial Reports",
      "Vendor Reports",
      "Finance Reports",
      "Invoice & ITC Reports",
    ],
  },
  {
    title: "Masters",
    items: [
      "Companies",
      "Sites / Projects",
      "Work Categories",
      "Cost Codes",
      "Document Types",
      "Tax Codes",
    ],
  },
  {
    title: "Administration",
    items: ["Users", "Roles", "Permission Matrix", "User Scope Assignment"],
  },
];

const kpis = [
  ["Pending Approvals", "18"],
  ["Pending RA Bills", "12"],
  ["Pending ITC Review", "8"],
  ["Pending Payments", "5"],
];

const managementCards = [
  ["Total Contract Value", "₹12.4 Cr"],
  ["Outstanding Payable", "₹82 L"],
  ["Active Projects", "9"],
  ["Active Vendors", "48"],
];

const recentWorkOrders = [
  ["CRPF/MRC/101", "CRPF HQ", "ABC Contractors", "₹22.4L", "Active"],
  ["IIIT/MRC/204", "IIIT Sonipat", "Sharma Civil", "₹18.2L", "Pending RA"],
  ["BUS/MRC/044", "Bus Stand", "KP Interiors", "₹31.7L", "Approved"],
];

const pendingApprovals = [
  ["RA Bill", "RA-01", "CRPF HQ", "₹8.2L"],
  ["Debit Note", "DN-07", "IIIT Sonipat", "₹48K"],
  ["Work Order", "WO-118", "Railway Station", "₹14.5L"],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="flex">
        <aside className="min-h-screen w-80 border-r bg-slate-950 px-5 py-6 text-white">
          <div className="mb-8">
            <h1 className="text-2xl font-bold">MRC Commercial</h1>
            <p className="text-sm text-slate-400">Construction Contract ERP</p>
          </div>

          <nav className="space-y-6">
            {sidebarSections.map((section) => (
              <div key={section.title}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {section.title}
                </p>
                <div className="space-y-1">
                  {section.items.map((item, index) => (
                    <div
                      key={item}
                      className={`rounded-lg px-3 py-2 text-sm font-medium ${
                        section.title === "Dashboard" && index === 0
                          ? "bg-white text-slate-950"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      }`}
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
              <h2 className="text-2xl font-bold text-slate-900">Command Center</h2>
              <p className="text-sm text-slate-500">
                MRC Group · Contract Management · SaaS-ready foundation
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                className="h-10 w-72 rounded-md border bg-white px-3 text-sm"
                placeholder="Search WO, vendor, invoice..."
              />
              <Badge variant="secondary">Platform Owner</Badge>
              <Button>Create Work Order</Button>
            </div>
          </header>

          <div className="space-y-6 p-8">
            <div className="grid gap-4 md:grid-cols-4">
              {kpis.map(([label, value]) => (
                <Card key={label}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-500">
                      {label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              {managementCards.map(([label, value]) => (
                <Card key={label}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-500">
                      {label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Contract Flow</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-6">
                  {[
                    "Work Order",
                    "RA Bill",
                    "Invoice / ITC",
                    "Payment",
                    "Debit Note",
                    "Ledger",
                  ].map((step) => (
                    <div
                      key={step}
                      className="rounded-xl border bg-white p-4 text-center text-sm font-semibold"
                    >
                      {step}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Recent Work Orders</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {recentWorkOrders.map(([wo, site, vendor, value, status]) => (
                      <div
                        key={wo}
                        className="grid grid-cols-5 items-center rounded-lg border p-3 text-sm"
                      >
                        <div className="font-semibold">{wo}</div>
                        <div className="text-slate-500">{site}</div>
                        <div className="text-slate-500">{vendor}</div>
                        <div className="font-medium">{value}</div>
                        <Badge variant="outline">{status}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Pending Approval Queue</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {pendingApprovals.map(([type, number, site, value]) => (
                      <div
                        key={number}
                        className="grid grid-cols-4 items-center rounded-lg border p-3 text-sm"
                      >
                        <Badge variant="secondary">{type}</Badge>
                        <div className="font-semibold">{number}</div>
                        <div className="text-slate-500">{site}</div>
                        <div className="font-medium">{value}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}