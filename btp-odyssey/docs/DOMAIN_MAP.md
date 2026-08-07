# Verified SAP Domain Map (curriculum scaffold)

**Retrieval date:** 2026-08-07  
**Confidence:** medium unless noted — **expert review required** before marketing accuracy claims.

Official hubs used as starting points (not scraped in full in this build):

- https://help.sap.com/docs/btp  
- https://cap.cloud.sap/  
- https://ui5.sap.com/  
- https://help.sap.com/docs/HANA_CLOUD  
- https://help.sap.com/docs/integration-suite  

| Domain ID | District | Products (names) | Confidence | Notes |
|-----------|----------|------------------|------------|-------|
| ui5-fiori | Experience City | SAPUI5, Fiori, Fiori elements | medium | Deep debugging scenarios planned R2 |
| cap | Cloud Application Foundry | CAP Node/Java | medium | |
| rap-abap | Clean Core Citadel | RAP, ABAP Cloud | low | Content deferred deeper to R2 |
| integration | Integration Transit Network | Integration Suite, Cloud Integration | medium | |
| events | Event Constellation | Event Mesh / event services | medium | Distinguish from similarly named products |
| bpa | Automation Works | Build Process Automation | low | R3 |
| workzone | Digital Workplace Plaza | Build Work Zone | low | R3 |
| bdc | Data Galaxy | Business Data Cloud ecosystem | low | Verify relationships — not a simple rename |
| datasphere | Semantic Fabric | Datasphere | low | R4 |
| databricks-sap | Lakehouse Research Station | SAP Databricks | low | R4 |
| sac | Decision Observatory | Analytics Cloud | low | R4 |
| hana-cloud | Data Core | HANA Cloud | medium | |
| security | Trust Fortress | IAS/IPS, XSUAA concepts | medium | Terminology may evolve |
| operations | Mission Control | BTP admin, CF/Kyma concepts | medium | |
| ai | Cognitive Laboratory | Responsible AI on BTP topics | low | R4+ |
| incident | Incident Foundry | Cross-cutting | medium | |
| architecture | Architecture Arena | Cross-cutting | medium | |

## Uncertain / expert-review queue

1. Current preferred authorization service naming vs classic XSUAA in new accounts  
2. Business Data Cloud product relationship graph  
3. Event service portfolio naming by region  
4. Kyma vs CF default teaching path for R1 (R1 uses CF-like env)  

Do **not** present simulated behavior as guaranteed live SAP behavior.
