# Pareto Game

A static Roosevelt Island mapping study, designed for GitHub Pages.

## Preview locally

From the repository root, run:

```powershell
python -m http.server 4173
```

Then open http://localhost:4173.

## Publish with GitHub Pages

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. Push to `main` to trigger the deployment workflow. The site will be available at https://aecao.github.io/pareto-game/ after the first successful deployment.

Building and place assets belong in [`assets/buildings/`](assets/buildings/); see its README for the expected GeoJSON format.