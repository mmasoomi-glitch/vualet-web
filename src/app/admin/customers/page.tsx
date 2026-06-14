import { PageHeader } from "@/components/admin/ui";
import { CustomersTable } from "@/components/admin/customers-table";
import { getCustomers } from "@/lib/admin-stub";

export default function AdminCustomersPage() {
  // REAL HOOK: fetch + paginate server-side; pass page slice to the table.
  const customers = getCustomers();

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Search, filter, and drill into any account. Click a row for detail and actions."
      />
      <CustomersTable customers={customers} />
    </>
  );
}
