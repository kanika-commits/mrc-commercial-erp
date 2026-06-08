export default function WorkOrdersPage() {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">
          Work Order Register
        </h1>

        <button className="bg-blue-600 text-white px-4 py-2 rounded">
          + Create Work Order
        </button>
      </div>

      <div className="bg-white p-4 rounded border mb-4">
        <input
          placeholder="Search Work Orders..."
          className="border rounded px-3 py-2 w-80"
        />
      </div>

      <div className="bg-white rounded border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left p-3">WO No</th>
              <th className="text-left p-3">Project</th>
              <th className="text-left p-3">Vendor</th>
              <th className="text-left p-3">Value</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Action</th>
            </tr>
          </thead>

          <tbody>
            <tr className="border-b">
              <td className="p-3">CRPF/MRC/101</td>
              <td className="p-3">CRPF HQ</td>
              <td className="p-3">ABC Contractors</td>
              <td className="p-3">₹22.4L</td>
              <td className="p-3">
                <span className="bg-green-100 text-green-700 px-2 py-1 rounded">
                  Active
                </span>
              </td>
              <td className="p-3">
                <button className="border px-3 py-1 rounded">
                  View
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}