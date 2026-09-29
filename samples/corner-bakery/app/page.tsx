import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Corner Bakery</h1>
      <p>Fresh bread and pastries, baked every morning. Order online for pickup.</p>
      <Link href="/menu">See the menu</Link>
    </main>
  );
}
