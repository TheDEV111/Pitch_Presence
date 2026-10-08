.DEFAULT_GOAL := start

.PHONY: start dev frontend backend worker help

# Start the frontend (port 3000) and backend (port 4000) together.
start:
	npm run dev

dev: start

frontend:
	npm run dev:web

backend:
	npm run dev:api

# Run in a separate terminal for email, payment and device notification jobs.
worker:
	npm run worker

help:
	@echo "make start     Start frontend and backend together (default)"
	@echo "make dev       Alias for make start"
	@echo "make frontend  Start only the frontend"
	@echo "make backend   Start only the backend"
	@echo "make worker    Start the email, payment and notification worker"
