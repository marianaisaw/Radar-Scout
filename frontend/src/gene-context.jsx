import { createContext, useContext } from "react";

export const GeneContext = createContext(null);

export const useGene = () => useContext(GeneContext);
