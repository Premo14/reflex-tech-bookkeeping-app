# Frontend Service (React)

The frontend is a React Single Page Application (SPA) built with TypeScript and Tailwind CSS. It provides the user interface for reviewing transactions, approving AI-suggested reconciliations, and managing accounting periods.

## Architecture
- **Vite**: Used for fast development server and production bundling.
- **Tailwind CSS**: Utility-first CSS framework for styling.
- **TypeScript**: Ensures type safety across the frontend and matches the data models defined in the backend.

## Development
The frontend runs in a Docker container using the Vite development server. It supports Hot Module Replacement (HMR) through the Nginx reverse proxy. Changes to React components will instantly reflect in the browser without a full page reload.
