# RADAR-Thermodynamics

The product UI is a React dashboard (not Streamlit). Python still runs the science: SQLite candidates, GTEx long-read isoforms, Ensembl FASTA, RNAplfold, RNAfold.

```bash
python -m pip install -r requirements.txt
cd frontend && npm install && cd ..
uvicorn api:app --reload --port 8000
# in another terminal:
cd frontend && npm run dev
```

Open http://localhost:5173

Existing RADAR design identifies sequence-compatible targets, but structural accessibility and hybridization thermodynamics may help predict which compatible endogenous targets will actually perform well, reducing the amount of empirical screening required.

- Commit 1: READ.ME file
- Commit 2: Now we have 10 isoforms of ADAM12. I set up a Streamlit app in 'fasta.py' that takes a human gene symbol, downloads its transcript FASTA from NCBI Datasets, and lets us view or download it. A 'sequences.txt' file contains the pasted ADAM12 FASTA from the internet and from the app; those two pastes are the same NCBI Datasets multi-FASTA (10 isoforms, same headers and sequences). The actual sequence for the 10 ADAM12 isoforms is stored in ADAM12_transcriptsFile.fasta
