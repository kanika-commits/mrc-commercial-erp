export default function VendorsPage() {
  const vendors = [
    {
      id: 1,
      name: "Design Well (India) Pvt. Ltd.",
      type: "Consultant",
      gstin: "07ABCDE1234F1Z5",
      contact: "Ramesh Kumar",
      phone: "9876543210",
      status: "Active",
    },
    {
      id: 2,
      name: "ABC Electricals",
      type: "Subcontractor",
      gstin: "07ABCDE5678F1Z5",
      contact: "Manoj Singh",
      phone: "9999999999",
      status: "Active",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Vendor Master</h1>
          <p className="text-gray-500">
            Manage contractors, subcontractors, consultants and suppliers.
          </p>
        </div>

        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg">
          + Add Vendor
        </button>
      </div>

      <div className="bg-white border rounded-lg p-4">
        <input
          placeholder="Search vendor..."
          className="w-full border rounded-lg px-3 py-2"
        />
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-3">Vendor Name</th>
              <th className="text-left p-3">Type</th>
              <th className="text-left p-3">GSTIN</th>
              <th className="text-left p-3">Contact Person</th>
              <th className="text-left p-3">Phone</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Action</th>
            </tr>
          </thead>

          <tbody>
            {vendors.map((vendor) => (
              <tr key={vendor.id} className="border-t">
                <td className="p-3">{vendor.name}</td>
                <td className="p-3">{vendor.type}</td>
                <td className="p-3">{vendor.gstin}</td>
                <td className="p-3">{vendor.contact}</td>
                <td className="p-3">{vendor.phone}</td>
                <td className="p-3">
                  <span className="bg-green-100 text-green-700 px-2 py-1 rounded">
                    {vendor.status}
                  </span>
                </td>
                <td className="p-3">
                  <button className="border px-3 py-1 rounded">
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}