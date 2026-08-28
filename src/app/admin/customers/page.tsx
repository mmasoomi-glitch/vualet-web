import { PageHeader } from "@/components/admin/ui";
import { CustomersTable } from "@/components/admin/customers-table";
import { getAdminCustomers } from "@/lib/admin-data";

export default async function AdminCustomersPage() {
  const customers = await getAdminCustomers();
  return (
    <>
      <PageHeader title="Customers" subtitle="Live subscription records from the store. Fields this app does not hold (name, country, usage) are not shown rather than invented." />
      <CustomersTable customers={customers} />
    </>
  );
}
