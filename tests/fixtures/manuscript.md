# Retrieval for small models

## Abstract
We propose a retrieval step that improves accuracy by 12% on a question answering benchmark. We evaluate on 200 questions from one dataset and compare against one baseline.

## Method
Documents are split into passages of 100 words. A bi-encoder ranks passages, and the top three are given to the model. We do not tune the passage length.

## Results
Accuracy rose from 61% to 73% (n = 200). No confidence intervals are reported. The improvement is attributed to better grounding.

## Limitations
Only English text was tested.
