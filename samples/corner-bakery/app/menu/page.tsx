"use client";

import { useEffect, useState } from "react";

interface Item {
  id: number;
  name: string;
  price_cents: number;
  special: boolean;
}

export default function Menu() {
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch(`/api/menu?q=${query}`)
      .then((r) => r.json())
      .then((d) => setItems(d.items));
  }, [query]);

  return (
    <main>
      <h1>Menu</h1>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" />
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.name} ${(item.price_cents / 100).toFixed(2)} {item.special ? "(today's special)" : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
