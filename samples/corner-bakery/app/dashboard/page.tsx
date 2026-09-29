"use client";

import { useEffect, useState } from "react";

interface Order {
  id: string;
  status: string;
  total_cents: number;
  customers: { email: string; phone: string };
}

export default function Dashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    setRole(localStorage.getItem("role"));
    fetch("/api/staff/orders")
      .then((r) => r.json())
      .then((d) => setOrders(d.orders));
  }, []);

  if (role !== "staff") return <p>Staff only.</p>;

  return (
    <main>
      <h1>Orders</h1>
      <ul>
        {orders.map((o) => (
          <li key={o.id}>
            {o.customers.email} paid ${(o.total_cents / 100).toFixed(2)} ({o.status})
            <button onClick={() => fetch("/api/staff/orders", { method: "PATCH", body: JSON.stringify({ id: o.id, status: "ready" }) })}>Mark ready</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
