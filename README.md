#  Pulsar

Pulsar is an intelligent, automated lead generation and outreach platform designed to bridge the gap between Ideal Candidate Profiles (ICPs) and high-quality leads. By combining a Next.js frontend with a distributed agent architecture powered by FastAPI and Playwright, Pulsar automates the discovery, validation, and outreach process across multiple platforms.

---

##  Architecture

Pulsar is built as a modular ecosystem:

- **Frontend (web-app)**: A Next.js application handling the standard CRUD operations, authentication, and campaign management. Integration with Supabase ensures robust data persistence and real-time updates.
- **Agent Service (ml-service)**: A FastAPI-based backend that orchestrates specialized agents. It handles short-lived API requests directly and manages long-running background tasks.
- **Task Queue**: Powered by **BullMQ** and **Redis**. Long-running discovery and analysis jobs are offloaded to this queue to ensure reliability and scalability.
- **Real-time Feedback**: Progress and results are emitted from the server to the frontend via **Server-Side Events (SSE)**, providing a seamless user experience.

---

##  Agents

At the heart of Pulsar is a network of agents:

- **Master Agent (WIP)**: Responsible for interpreting product descriptions and ICPs to create and delegate campaign tasks.
- **Sub-Agents**: Specialized workers for specific platforms.
    - **Instagram Agent (Functional)**: An autonomous web-agent that:
        - Authenticates and manages sessions securely.
        - Scours hashtags and profiles based on specific criteria.
        - Intercepts GraphQL/REST traffic for high-fidelity data extraction.
        - Matches profiles against the defined ICP.
        - Injects visual indicators (thinking status) into the controlled browser for observability.

---

##  Status & Roadmap

###  Completed
- [x] **Next.js + Supabase Foundation**: Complete CRUD for users and campaigns.
- [x] **Distributed Infrastructure**: Redis + BullMQ integration functional.
- [x] **FastAPI Agent Framework**: Dedicated service for agent orchestration.
- [x] **Instagram Web Agent**: Fully functional lead discovery and profile analysis via web automation.
- [x] **Real-time Streaming**: SSE implementation for live result updates in the web UI.

###  Work in Progress / Next Steps
- [ ] **Master Agent**: Full automation of campaign creation from product descriptions.
- [ ] **Additional Platform Agents**: Expanding to LinkedIn, Twitter, and other strategic platforms.
- [ ] **API Integrations**: Transitioning to official APIs where available and free to improve efficiency.
- [ ] **CSV Export**: Ability to download discovered leads in a structured format.
- [ ] **Outreach Automation**: Direct messaging and follow-up sequences.

---

##  Local Development

Pulsar is (containerized) for easy setup.

### Prerequisites
- Docker & Docker Compose
- Node.js (for web-app local dev)
- Python 3.10+ (for agent local dev)

### Getting Started
1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd Pulsar
   ```

2. **Environment Setup**:
   Create `.env` files in both `web-app/` and `ml-service/` based on their respective `.env.example` templates.

3. **Launch Infrastructure**:
   ```bash
   docker-compose up -d
   ```
   This will spin up the Redis cache and the essential services.

---

##  Philosophy

Pulsar is built to be deterministic where possible and agentic where necessary. We prioritize high-fidelity data extraction and human-like interaction patterns to ensure long-term sustainability and quality over quantity in lead generation.
