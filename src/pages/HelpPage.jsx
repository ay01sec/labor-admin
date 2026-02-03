import ReactMarkdown from 'react-markdown';
import { HelpCircle } from 'lucide-react';
import manualContent from '../../MANUAL.md?raw';

export default function HelpPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
        <HelpCircle className="text-blue-500" />
        <span>ヘルプ</span>
      </h1>

      <div className="bg-white rounded-xl shadow-sm p-6 sm:p-8 prose prose-sm sm:prose max-w-none
        prose-headings:text-gray-800
        prose-h1:text-2xl prose-h1:border-b prose-h1:border-gray-200 prose-h1:pb-3 prose-h1:mb-6
        prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-4
        prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-3
        prose-p:text-gray-600 prose-p:leading-relaxed
        prose-li:text-gray-600
        prose-strong:text-gray-800
        prose-table:text-sm
        prose-th:bg-gray-50 prose-th:px-4 prose-th:py-2 prose-th:text-left prose-th:font-medium prose-th:text-gray-600
        prose-td:px-4 prose-td:py-2 prose-td:border-t prose-td:border-gray-100
        prose-blockquote:border-l-blue-500 prose-blockquote:bg-blue-50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-blockquote:text-blue-800 prose-blockquote:not-italic
        prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
        prose-hr:border-gray-200 prose-hr:my-8
      ">
        <ReactMarkdown>{manualContent}</ReactMarkdown>
      </div>
    </div>
  );
}
