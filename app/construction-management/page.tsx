import Link from "next/link";

const cards = [
  { title: "Companies", href: "/companies", description: "Manage companies." },
  { title: "Sites", href: "/sites", description: "Manage project sites." },
  { title: "Vendors", href: "/vendors", description: "Vendor master and documents." },
  { title: "Work Orders", href: "/work-orders", description: "Create and manage work orders." },
  { title: "WO Approval", href: "/approvals/work-orders", description: "Approve or reject work orders." },
  { title: "RA Bills", href: "/ra-bills", description: "RA bill entries and attachments." },
  { title: "Invoices", href: "/invoices", description: "Vendor invoices and ITC tracking." },
  { title: "Payments", href: "/payments", description: "Payment entries and UTR records." },
  { title: "Debit Notes", href: "/debit-notes", description: "Debit notes against vendors." },
  { title: "Reports", href: "/reports", description: "Commercial reports." },
];

export default function ConstructionManagementPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Construction Management</h1>
        <p className="text-gray-500">
          Manage contracts, vendors, work orders, RA bills, invoices and payments.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border bg-white p-5 hover:bg-gray-50"
          >
            <h2 className="text-lg font-semibold">{card.title}</h2>
            <p className="mt-2 text-sm text-gray-500">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}