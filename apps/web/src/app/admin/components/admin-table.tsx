import { displayDate, displayValue, type AdminRow } from "../lib/admin-api";

type Column = {
  key: string;
  label: string;
  type?: "date";
};

export function AdminTable({
  rows,
  columns,
  emptyText
}: {
  rows: AdminRow[];
  columns: Column[];
  emptyText: string;
}) {
  if (rows.length === 0) {
    return <div className="admin-empty">{emptyText}</div>;
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.type === "date" ? displayDate(row[column.key]) : displayValue(row[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
