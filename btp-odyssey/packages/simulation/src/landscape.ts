/** @deprecated Import from landscapes.js */
export {
  buildStartupLandscape,
  buildLandscape,
  buildNorthwind,
} from "./landscapes.js";
export const LANDSCAPE_FIDELITY_NOTES = {
  behaviorsRepresented: [
    "Subaccount hierarchy",
    "Service bindings and destinations",
    "Health and dependency edges",
  ],
  behaviorsSimplified: ["No real JWT", "No live SAP runtime"],
  behaviorsOmitted: ["Real CF push", "Cloud Connector"],
  differencesFromReal: ["Injected defects via configuration and synthetic telemetry"],
};
