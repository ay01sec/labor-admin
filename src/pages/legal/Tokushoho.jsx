import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Building } from 'lucide-react';
import content from '../../../docs/legal/TOKUSHOHO.md?raw';

export default function Tokushoho() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
        <Building className="text-blue-500" />
        <span>特定商取引法に基づく表記</span>
      </h1>

      <div className="bg-white rounded-xl shadow-sm p-6 sm:p-8 prose prose-sm sm:prose max-w-none
        prose-headings:text-gray-800
        prose-h1:text-2xl prose-h1:border-b prose-h1:border-gray-200 prose-h1:pb-3 prose-h1:mb-6
        prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-4
        prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-3
        prose-p:text-gray-600 prose-p:leading-relaxed
        prose-li:text-gray-600
        prose-strong:text-gray-800
      ">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
