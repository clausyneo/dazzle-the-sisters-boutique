# Dazzle the Sister's Boutique

A full-stack e-commerce website developed as a BCA Minor Project.

## About the Project

Dazzle the Sister's Boutique is an online boutique shopping platform designed to showcase women's ethnic wear and simplify the online shopping and order-management process.

The platform provides a customer-facing shopping experience and a separate administration panel for managing products, orders and COD payments.

## Features

### Customer
- Customer registration and login
- Customer profile management
- Product catalogue and product details
- Shopping cart and checkout
- Cash on Delivery (COD)
- Order history and order tracking
- Email notifications
- Password recovery

### Administration
- Secure admin login
- Order management dashboard
- Order status updates
- Customer order details
- COD payment recording
- Order and payment status management

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js |
| Server | Node.js HTTP server |
| Database | MySQL |
| Database Driver | mysql2 |
| Version Control | Git and GitHub |

## Project Structure

```text
minorproject/
├── backend/
│   ├── accounts.js
│   ├── admin.js
│   ├── database.js
│   ├── email.js
│   ├── orders.js
│   ├── server.js
│   └── tests
├── database/
│   ├── migrations/
│   ├── checkout_schema.sql
│   └── dazzle_boutique.sql
├── frontend/
│   ├── assets/
│   ├── css/
│   ├── js/
│   └── HTML pages
├── package.json
├── package-lock.json
├── .env.example
└── .gitignore
```

## Installation and Setup

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd minorproject
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy `.env.example` to `.env` and enter your local MySQL and SMTP configuration.

Never commit your actual `.env` file.

### 4. Configure MySQL

Create the `dazzle_boutique` database and execute the database schema and migration scripts in the appropriate order.

### 5. Start the backend

```bash
npm start
```

### 6. Open the frontend

Use VS Code Live Server to open:

```text
frontend/index.html
```

## Testing

Run the automated tests:

```bash
npm test
```

Run the project checks:

```bash
npm run check
```

## Project Scope

This minor project focuses on readymade product shopping, customer accounts, COD checkout, order tracking and basic administration.

Advanced boutique operations such as custom stitching management, digital measurements and advanced inventory management are outside the current minor-project scope.

## Project Status

Core customer shopping, administration, order management and COD payment workflows have undergone manual end-to-end testing.

## Academic Project

**Degree:** Bachelor of Computer Applications (BCA)

**Project:** Dazzle the Sister's Boutique

**Project Type:** Minor Project

---

Developed for academic and practical learning purposes.