# ECMA-404 Sample Data — Provenance and License Notice

This directory bundles a small sample corpus used to power the desktop app's
"Try the sample project" first-run flow. It is derived from the GRAFT
pipeline's existing evaluation fixtures for the ECMA-404 standard
("The JSON Data Interchange Syntax", 2nd Edition, December 2017).

## File provenance

| File in this directory | Copied from | Description |
|---|---|---|
| `ecma404_json.pdf` | `data/test_corpus_allpdf/ecma404_json.pdf` (main checkout) | The original ECMA-404 standard PDF, as ingested by the pipeline. |
| `s2_chunks_full.json` | `data/test_corpus_allpdf/pipeline_run/ecma404_json_full/checkpoints/s2_chunks_full.json` (main checkout) | Stage 2 chunking checkpoint — the PDF split into retrieval chunks. |
| `facts_ecma404_json_full.json` | `data/eval_results/facts_v1_grounded/facts_ecma404_json_full.json` (phase2-studio worktree) | Grounded fact extraction output (40 facts with source/page/bbox anchors). |
| `qa_ecma404_json_full.json` | `data/eval_results/allpdf_v2_gt_r3/final/ecma404_json_full.json` (phase2-studio worktree, renamed with `qa_` prefix) | Final generated ground-truth QA pairs (20 pairs, wrapper shape). |

These are pre-existing pipeline outputs staged as static resources; no new
processing was performed on the source PDF as part of this task.

## ECMA-404 copyright and permission notice (verbatim)

The following notice is quoted verbatim from page v (front matter, the page
following the table of contents) of `ecma404_json.pdf`, under the heading
"COPYRIGHT NOTICE":

> "COPYRIGHT NOTICE
>
> © 2017 Ecma International
>
> This document may be copied, published and distributed to others, and certain derivative works of it
> may be prepared, copied, published, and distributed, in whole or in part, provided that the above
> copyright notice and this Copyright License and Disclaimer are included on all such copies and
> derivative works. The only derivative works that are permissible under this Copyright License and
> Disclaimer are:
>
> (i) works which incorporate all or portion of this document for the purpose of providing commentary or
> explanation (such as an annotated version of the document),
>
> (ii) works which incorporate all or portion of this document for the purpose of incorporating features
> that provide accessibility,
>
> (iii) translations of this document into languages other than English and into different formats and
>
> (iv) works by making use of this specification in standard conformant products by implementing (e.g.
> by copy and paste wholly or partly) the functionality therein.
>
> However, the content of this document itself may not be modified in any way, including by removing the
> copyright notice or references to Ecma International, except as required to translate it into languages
> other than English or into a different format.
>
> The official version of an Ecma International document is the English language version on the Ecma
> International website. In the event of discrepancies between a translated version and the official
> version, the official version shall govern.
>
> The limited permissions granted above are perpetual and will not be revoked by Ecma International or
> its successors or assigns.
>
> This document and the information contained herein is provided on an "AS IS" basis and ECMA
> INTERNATIONAL DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT
> LIMITED TO ANY WARRANTY THAT THE USE OF THE INFORMATION HEREIN WILL NOT
> INFRINGE ANY OWNERSHIP RIGHTS OR ANY IMPLIED WARRANTIES OF MERCHANTABILITY OR
> FITNESS FOR A PARTICULAR PURPOSE

Full document identification, from the PDF's cover page: **ECMA-404,
2nd Edition / December 2017, "The JSON Data Interchange Syntax"**,
© Ecma International 2017 / 2009, published by Ecma International,
Rue du Rhône 114, CH-1204 Geneva.

The pipeline-derived files in this directory (`s2_chunks_full.json`,
`facts_ecma404_json_full.json`, `qa_ecma404_json_full.json`) are
GRAFT-generated artifacts derived from the above document for the purpose
of demonstrating and evaluating the retrieval-augmented generation ground
truth pipeline; they fall under permitted derivative-work category (iv)
above (implementing/using the specification's content in a conformant
product).
