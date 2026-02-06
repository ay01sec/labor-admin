import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import content from '../../../docs/legal/TERMS_OF_SERVICE.md?raw';

export default function TermsOfService() {
  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link to="/help" className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
          <FileText className="text-blue-500" />
          <span>利用規約</span>
        </h1>
      </div>

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
