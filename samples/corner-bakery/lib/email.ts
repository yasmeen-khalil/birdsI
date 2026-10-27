import axios from "axios";

// Sends the order confirmation. Called after checkout.
export async function sendConfirmation(to: string, orderId: string) {
  axios.post("https://api.emailservice.example/v1/send", {
    to,
    subject: `Your Corner Bakery order ${orderId}`,
    text: "Thanks for your order. We will have it ready soon.",
  });
}
