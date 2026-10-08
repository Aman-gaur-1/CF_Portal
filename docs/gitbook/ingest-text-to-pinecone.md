# Ingest Text into Pinecone with LangChain

The script takes text from a file, splits it into smaller pieces, turns each piece into an embedding, and saves the results in Pinecone. A RAG application can later search those vectors to find relevant text.

## What the script does

```text
consoleflareblog.txt
        ↓
UnstructuredLoader
        ↓
CharacterTextSplitter
        ↓
NVIDIA embeddings
        ↓
Pinecone index
```

There are two rounds of splitting here. Unstructured first groups extracted text into chunks of up to 10,000 characters. LangChain then splits those documents again, aiming for 1,000 characters per chunk.

## Before you run it

Install the packages used by the script:

```bash
pip install python-dotenv langchain-unstructured langchain-text-splitters langchain-nvidia-ai-endpoints langchain-pinecone
```

Create a `.env` file in the working directory:

```env
NVIDIA_API_KEY=your_nvidia_api_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_index_name
```

Do not commit `.env` to Git. Put `consoleflareblog.txt` in the folder where you run the script, or update the path in the code. Create the Pinecone index first, and set its vector dimension to match the NVIDIA model.

## Functions, classes, and methods

### `load_dotenv()`

Reads values from `.env` and adds them to the process environment. That lets the libraries use your API keys without writing them into the Python file.

```python
load_dotenv()
```

Use it for local settings and credentials that you do not want to hard-code.

### `UnstructuredLoader(file_path, ...)`

This class reads a file and returns its text as LangChain documents. The example points it at a local text file.

| Argument | Meaning in this script |
|---|---|
| `file_path` | `consoleflareblog.txt`, the source file to read. |
| `chunking_strategy` | `"basic"` combines neighboring elements into chunks while respecting Unstructured's chunk-size settings. |
| `max_characters` | `10000`, the maximum size used for Unstructured's initial chunks. |

Example:

```python
loader = UnstructuredLoader(
    "consoleflareblog.txt",
    chunking_strategy="basic",
    max_characters=10000,
)
```

### `loader.load()`

Reads the file and returns LangChain `Document` objects. Each one has text in `page_content` and can carry metadata, such as the source file name.

```python
documents = loader.load()
print(len(documents))
```

Call `load()` when the file is small enough to read into memory at once. For very large files, the loader also has lazy-loading methods.

### `CharacterTextSplitter(chunk_size, chunk_overlap)`

This splitter breaks document text at a chosen character separator. It keeps the source documents' metadata on the resulting chunks.

| Argument | Meaning |
|---|---|
| `chunk_size` | Target maximum chunk length, measured in characters by default. Here it is `1000`. |
| `chunk_overlap` | Number of characters shared between neighboring chunks. Here it is `0`, so chunks do not intentionally repeat text. |
| `separator` | The default separator is a blank line (`"\n\n"`). It can be set explicitly to choose another boundary. |

Example:

```python
splitter = CharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
```

Use it for plain text when splitting at a character boundary works for your content. If you need to preserve headings or sentence boundaries, choose a recursive or format-aware splitter. A long paragraph with no separator can end up larger than `chunk_size`.

### `text_splitter.split_documents(documents)`

Takes documents and returns smaller documents. Their metadata carries over to the new chunks.

```python
chunks = text_splitter.split_documents(document)
```

The script uses Python's `len()` to print how many chunks it made.

### `NVIDIAEmbeddings(model=...)`

Creates the NVIDIA embedding client. An embedding is a list of numbers that represents a piece of text. Pinecone compares these vectors to find text with a similar meaning.

| Argument | Meaning |
|---|---|
| `model` | NVIDIA model ID. This script uses `nvidia/nemotron-3-embed-1b`. |
| API key | Read by the integration from the environment, normally `NVIDIA_API_KEY`. |

Example:

```python
embeddings = NVIDIAEmbeddings(model="nvidia/nemotron-3-embed-1b")
```

During ingestion, the vector store asks this client to embed each document. A later search uses it to embed the user's query. Keep the model and settings consistent for both. Nemotron 3 Embed has separate input types for documents (`passage`) and queries (`query`), so check that your installed LangChain integration handles both for this model.

### `PineconeVectorStore.from_documents(...)`

Sends LangChain documents to Pinecone. The method embeds their text and stores the vectors and metadata in the named index.

| Argument | Meaning |
|---|---|
| `text` | The list of chunked `Document` objects. |
| `embeddings` | The embedding client that converts text to vectors. |
| `index_name` | The existing Pinecone index name. |

Example:

```python
vector_store = PineconeVectorStore.from_documents(
    text,
    embeddings,
    index_name=os.environ["PINECONE_INDEX_NAME"],
)
```

The Pinecone client reads its API key from `PINECONE_API_KEY`. The expression `os.environ["PINECONE_INDEX_NAME"]` gets the index name. Python raises `KeyError` if that setting is missing.

## Walk through the script

1. **Import the libraries.** The imports bring in the loader, splitter, embedding client, vector store, and environment helper.
2. **Read settings.** `load_dotenv()` loads the values from `.env` so Python and the integrations can access them.
3. **Check how the file is being run.** The `__main__` condition runs the ingestion code when you launch this file directly. It skips that code if another Python file imports it.
4. **Load the text.** The loader reads `consoleflareblog.txt` and returns LangChain documents.
5. **Make smaller chunks.** The splitter targets 1,000 characters per chunk, with no overlap. The script prints the number it created.
6. **Choose the embedding model.** `NVIDIAEmbeddings` converts each chunk into a vector.
7. **Save the vectors.** `from_documents(...)` embeds the chunks and writes them to the configured Pinecone index.
8. **Print a finish message.** `'FINISH'.center(50, '-')` adds hyphens around the word. It only prints a message; it does not check whether search results are good.

## Common issues

- **File not found:** move the text file into the folder where you run the script, or change the path.
- **Missing setting:** check the spelling in `.env` and make sure the file is where `load_dotenv()` can find it. Accessing a missing key with `os.environ["..."]` raises an error.
- **Authentication fails:** check that both API keys are valid and available to the process.
- **Pinecone dimension error:** the index dimension must match the number of values returned by the embedding model.
- **Chunks are larger than expected:** the loader and splitter each have their own chunking rules. The splitter breaks on blank lines by default, so a long paragraph may stay intact and exceed the target.
- **Rerunning creates more vectors:** the script does not assign IDs or clear old data. Set an ID and namespace strategy before using it for repeated imports.

## Full code

```python
import os

from dotenv import load_dotenv
from langchain_unstructured import UnstructuredLoader
from langchain_text_splitters import CharacterTextSplitter
from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings
from langchain_pinecone import PineconeVectorStore


load_dotenv()

if __name__ == "__main__":

    print('Ingesting........')
    loader = UnstructuredLoader('consoleflareblog.txt',chunking_strategy='basic',max_characters=10000)
    document = loader.load()

    # Creating Chunk

    print('Splitting.....')

    text_splitter = CharacterTextSplitter(chunk_size=1000,chunk_overlap=0)
    text = text_splitter.split_documents(document)
    print(f'Created {len(text)} Chunks')
    # print(text)

    # for i, chunk in enumerate(text):
    #     print(f'\n --- Chunk {i + 1} ---')
    #     print(chunk.page_content[:300])


    # Ingesting
    embeddings = NVIDIAEmbeddings(model="nvidia/nemotron-3-embed-1b")

    print('Ingesting.....')
    PineconeVectorStore.from_documents(text,embeddings,index_name=os.environ["PINECONE_INDEX_NAME"])
    print('FINISH'.center(50,'-'))
```

## References

- [LangChain: `UnstructuredLoader`](https://reference.langchain.com/python/langchain-unstructured/document_loaders/UnstructuredLoader)
- [Unstructured: chunking strategies](https://docs.unstructured.io/api-reference/partition/chunking)
- [LangChain: text splitter reference](https://reference.langchain.com/python/langchain-text-splitters/base/TextSplitter)
- [LangChain: `NVIDIAEmbeddings`](https://reference.langchain.com/python/langchain-nvidia-ai-endpoints/embeddings/NVIDIAEmbeddings)
- [NVIDIA: Nemotron 3 Embed API](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-embed-1b-infer)
- [LangChain: `PineconeVectorStore`](https://reference.langchain.com/python/langchain-pinecone/vectorstores/PineconeVectorStore)
