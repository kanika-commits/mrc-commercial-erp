export default function WorkOrderDetailPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold">CRPF/GLC/101</h1>
        <p className="text-gray-500">
          CRPF HQ, Delhi · Design Well (India) Pvt. Ltd. · Consultant
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          ["Total Work Done", "₹44,25,000"],
          ["Total Invoices", "₹47,87,850"],
          ["Total Payments", "₹45,13,500"],
          ["Balance", "₹2,74,350"],
        ].map(([label, value]) => (
          <div key={label} className="rounded border bg-white p-4">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="mt-2 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded border bg-white p-4 mb-6">
        <h2 className="mb-4 text-xl font-bold">Work Order Details</h2>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-gray-500">Description</p>
            <p className="font-semibold">Work Order for Project Consultant</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">Status</p>
            <span className="rounded bg-green-100 px-2 py-1 text-green-700">
              Active
            </span>
          </div>

          <div>
            <p className="text-sm text-gray-500">WO Type</p>
            <p className="font-semibold">Consultant</p>
          </div>
        </div>
      </div>

      <Section
        title="RA Bills"
        columns={["RA Bill No.", "Date", "Work Done", "GST", "Payable", "Files"]}
        rows={[
          ["1", "11-Feb-2026", "₹18,00,000", "₹3,24,000", "₹21,24,000", "PDF / XLSX"],
          ["2", "21-May-2026", "₹6,00,000", "₹1,08,000", "₹7,08,000", "PDF"],
        ]}
      />

      <Section
        title="Invoices"
        columns={["Invoice No.", "Date", "Basic", "GST", "Total", "ITC", "Files"]}
        rows={[
          ["DWI/25 26/AC/25", "01-Jan-2026", "₹6,00,000", "₹1,08,000", "₹7,08,000", "Claimed", "Invoice File"],
          ["DWI/25 26/AC/31", "11-Feb-2026", "₹3,00,000", "₹54,000", "₹3,54,000", "Claimed", "Invoice File"],
        ]}
      />

      <Section
        title="Payments"
        columns={["Payment Date", "Contractor", "Transferred", "TDS", "Total Payment"]}
        rows={[
          ["01-Jan-2026", "Design Well (India) Pvt. Ltd.", "₹5,40,000", "₹60,000", "₹6,00,000"],
          ["11-Feb-2026", "Design Well (India) Pvt. Ltd.", "₹12,96,000", "₹1,20,000", "₹14,16,000"],
        ]}
      />

      <Section
        title="Debit Notes"
        columns={["Date", "Type", "Amount", "Reason", "Files"]}
        rows={[]}
      />
    </div>
  );
}

function Section({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <div className="mb-6 rounded border bg-white p-4">
      <h2 className="mb-4 text-xl font-bold">{title}</h2>

      <table className="w-full">
        <thead>
          <tr className="border-b bg-gray-50">
            {columns.map((column) => (
              <th key={column} className="p-3 text-left text-sm">
                {column}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={index} className="border-b">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="p-3 text-sm">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="p-3 text-sm text-gray-500" colSpan={columns.length}>
                No entries found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}