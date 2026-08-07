# 🏦 SaveNest - Savings Plan Tracker & Payment Requests

SaveNest is a modern Single Page Web Application (SPA) designed to help you create savings plans, track target goals, log completed transactions, and send payment requests to friends and family with real-time response messaging.

> ⚠️ **Note**: SaveNest is a request & logging tool only. No real money transfers are processed inside this application. Transfer real money using your preferred banking or payment service.

---

## ✨ Key Features

- 🎯 **Savings Plan Manager**: Create specific savings goals (e.g. *"New Laptop Funds"*), set target amounts, choose category icons, and track real-time progress bars.
- 💳 **Transaction History Log**: Log deposits and withdrawals that have already occurred, updating your savings plan totals automatically.
- 📩 **Payment Requests Inbox & Outbox**: Request money from registered users with reason notes and optional links to your savings goals.
- 💬 **Real-Time Response Messaging**: Recipients can respond to payment requests with custom messages and Accept (Yes) / Decline (No) decisions.
- 🔥 **Firebase Real-Time Database & Auth**: Powered by **Firebase Auth** (Google Sign-In & Email/Password) and real-time **Cloud Firestore Database** (`onSnapshot` sync across devices).
- 🕒 **Recent Recipients History**: Automatically saves recent contact email addresses for quick click-to-fill reuse.
- 🎨 **Material Design 3 & GSAP v3 Motion**: Built with Material Design 3 tokens, Material Symbols, and smooth GreenSock (GSAP) micro-animations.
- 📱 **Responsive Mobile Navigation**: Dedicated bottom navigation bar for smartphones and tablets.
- 🌙 **Dark & Light Mode Themes**: Toggle between Midnight Slate and Daylight visual palettes with instant persistence.
- 🗑️ **Account Deletion & Safety**: Direct confirmation dialog for permanent account and data erasure.

---

## 🚀 Live Demo on GitHub Pages

This repository is configured for automatic deployment on **GitHub Pages**.

1. Visit the repository on GitHub: [github.com/sarwesv/savings-plan-tracker-and-invoice](https://github.com/sarwesv/savings-plan-tracker-and-invoice)
2. Go to **Settings** > **Pages**.
3. Under **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: Select `main` and folder `/ (root)`
4. Click **Save**.

Your app will be published live at:
`https://sarwesv.github.io/savings-plan-tracker-and-invoice/`

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla CSS3 (Custom Design System & Material 3), JavaScript (ES6 Modules)
- **Animations**: GSAP v3 (GreenSock Animation Platform)
- **Authentication**: Firebase Authentication (Google OAuth & Email/Password SDK)
- **Database**: Cloud Firestore Real-Time NoSQL Database
- **Hosting**: GitHub Pages & Firebase Hosting Compatible

---

## 💻 Local Setup & Development

To run SaveNest locally on your machine:

1. Clone the repository:
   ```bash
   git clone https://github.com/sarwesv/savings-plan-tracker-and-invoice.git
   cd savings-plan-tracker-and-invoice
   ```

2. Start a simple HTTP web server:
   ```bash
   python3 -m http.server 8080
   ```

3. Open your browser at `http://localhost:8080`.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.
