import Link from "next/link";

const cards = [
  { title: "Organizations", href: "/organizations", description: "Manage customer organizations." },
  { title: "Users", href: "/admin/users", description: "Create users and assign access." },
  { title: "Roles", href: "/admin/roles", description: "Manage role names and designations." },
  { title: "Permissions", href: "/admin/permissions", description: "Configure role permission templates." },
];

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Admin & Settings</h1>
        <p className="text-gray-500">
          Manage organizations, users, roles and permissions.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
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